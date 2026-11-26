"""知識庫自動同步（Git）：工作台開著就定期 commit → 拉另一台的改動 → push，不必開 Obsidian。

一輪同步：
1. 有改動就 commit（訊息含電腦名稱）
2. fetch，遠端有新的就 merge；**遇到衝突立刻 merge --abort**，保留本機 commit、不硬合併，狀態標成 conflict
3. 本機比遠端新就 push

和 Obsidian 的 Git 外掛同時跑也沒關係：另一邊正在用 git（有 index.lock）時這一輪直接跳過。
"""
import os
import platform
import subprocess
import threading
import time
from datetime import datetime

import config

INTERVAL_MINUTES = float(os.getenv("VAULT_SYNC_MINUTES", "5"))  # 0 = 關閉自動同步
AFTER_EDIT_SECONDS = 30  # 在工作台改了東西後，多久同步一次（期間再改會重新計時）

_lock = threading.Lock()
_debounce: threading.Timer | None = None
_state = {
    "enabled": False,
    "status": "idle",        # idle / syncing / ok / conflict / error / skipped
    "message": "",
    "last_sync": None,       # 最後一次成功完成的時間
    "last_attempt": None,
    "conflicts": [],
    "pulled": 0,             # 上一輪拉下來的 commit 數
    "pushed": 0,             # 上一輪推上去的 commit 數
}


class GitError(Exception):
    pass


def _git(*args, check=True, timeout=120) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_MERGE_AUTOEDIT": "no"}
    r = subprocess.run(["git", *args], cwd=config.VAULT_PATH, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout, env=env)
    if check and r.returncode != 0:
        raise GitError((r.stderr or r.stdout).strip()[:500] or f"git {args[0]} failed")
    return r.stdout.strip()


def available() -> bool:
    return (config.VAULT_PATH / ".git").exists()


def _busy_reason() -> str | None:
    git_dir = config.VAULT_PATH / ".git"
    if (git_dir / "index.lock").exists():
        return "Git is busy (another program, e.g. Obsidian, is syncing) — will retry"
    for name in ("MERGE_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply"):
        if (git_dir / name).exists():
            return "A merge or rebase is in progress in the vault — finish it in Obsidian or a terminal first"
    return None


def _set(**kw):
    _state.update(kw)


def sync_once(reason: str = "timer") -> dict:
    """同步一輪；同時只會有一輪在跑。"""
    if not available():
        _set(status="error", message="The vault isn't a Git repository")
        return status()
    if not _lock.acquire(blocking=False):
        return status()
    try:
        now = datetime.now().isoformat(timespec="seconds")
        _set(status="syncing", last_attempt=now, message="", conflicts=[])
        busy = _busy_reason()
        if busy:
            _set(status="skipped", message=busy)
            return status()

        branch = _git("branch", "--show-current") or "main"
        # 1. commit 本機改動
        if _git("status", "--porcelain"):
            _git("add", "-A")
            stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            _git("commit", "-m", f"vault backup ({platform.node() or 'dashboard'}): {stamp}")

        # 2. 拉遠端
        _git("fetch", "origin", branch, timeout=180)
        behind = int(_git("rev-list", "--count", f"HEAD..origin/{branch}") or 0)
        if behind:
            r = subprocess.run(["git", "merge", "--no-edit", f"origin/{branch}"], cwd=config.VAULT_PATH,
                               capture_output=True, text=True, encoding="utf-8", errors="replace",
                               env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_MERGE_AUTOEDIT": "no"})
            if r.returncode != 0:
                conflicts = [f for f in _git("diff", "--name-only", "--diff-filter=U", check=False).splitlines() if f]
                _git("merge", "--abort", check=False)  # 不硬合併：回到合併前，本機 commit 還在
                _set(status="conflict", conflicts=conflicts, pulled=0, pushed=0,
                     message="Both computers changed the same lines — nothing was overwritten. "
                             "Resolve it in Obsidian (Git: pull) or a terminal, then sync again.")
                return status()

        # 3. 推上去
        ahead = int(_git("rev-list", "--count", f"origin/{branch}..HEAD") or 0)
        if ahead:
            _git("push", "origin", branch, timeout=180)

        _set(status="ok", last_sync=datetime.now().isoformat(timespec="seconds"), pulled=behind, pushed=ahead,
             message="Up to date" if not (behind or ahead) else
             f"Pulled {behind} · pushed {ahead}" if behind and ahead else
             f"Pulled {behind} change{'s' if behind != 1 else ''}" if behind else
             f"Pushed {ahead} change{'s' if ahead != 1 else ''}")
    except subprocess.TimeoutExpired:
        _set(status="error", message="Git took too long (network?) — will retry")
    except (GitError, OSError) as e:
        _set(status="error", message=str(e))
    finally:
        _lock.release()
    return status()


def schedule_after_edit():
    """工作台改了知識庫（勾待辦、打卡…）→ 30 秒後同步；期間再改就重新計時。"""
    global _debounce
    if not _state["enabled"]:
        return
    if _debounce:
        _debounce.cancel()
    _debounce = threading.Timer(AFTER_EDIT_SECONDS, sync_once, kwargs={"reason": "edit"})
    _debounce.daemon = True
    _debounce.start()


def start_background():
    """工作台啟動時呼叫：先同步一次，之後每 INTERVAL_MINUTES 分鐘一次。"""
    if INTERVAL_MINUTES <= 0 or not available():
        return
    _set(enabled=True)

    def loop():
        while True:
            sync_once("timer")
            time.sleep(INTERVAL_MINUTES * 60)

    threading.Thread(target=loop, daemon=True, name="vault-sync").start()


def status() -> dict:
    return {**_state, "interval_minutes": INTERVAL_MINUTES, "available": available()}
