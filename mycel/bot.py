import asyncio
import json
import sqlite3
import subprocess
import tempfile
from pathlib import Path

from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).parent / ".env")

TELEGRAM_TOKEN = os.environ["MYCEL_TELEGRAM_TOKEN"]
ALLOWED_USER_ID = int(os.environ["TELEGRAM_USER_ID"])

from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

MYCEL_DIR = Path(__file__).parent
SPORE_ROOT = MYCEL_DIR.parent
SESSION_FILE = MYCEL_DIR / "session.json"  # shared with web UI
DB_PATH = os.environ.get("AUTOAPPLY_DB", str(SPORE_ROOT / "data" / "autoapply.db"))


def log_message(role: str, text: str) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO mycel_messages (role, text, source) VALUES (?, ?, 'telegram')",
            (role, text),
        )


def insert_divider() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO mycel_messages (role, text, source) VALUES ('divider', '', 'telegram')"
        )


def load_session_id() -> str | None:
    if SESSION_FILE.exists():
        return json.loads(SESSION_FILE.read_text()).get("session_id")
    return None


def save_session_id(session_id: str) -> None:
    SESSION_FILE.write_text(json.dumps({"session_id": session_id}))


def clear_session_id() -> None:
    SESSION_FILE.write_text(json.dumps({"session_id": None}))


def _run_claude(message: str, session_id: str | None) -> tuple[str, str]:
    cmd = [
        "claude",
        "--print",
        "--dangerously-skip-permissions",
        "--output-format", "json",
        "--add-dir", str(MYCEL_DIR),
        "--model", "claude-sonnet-4-6",
    ]
    if session_id:
        cmd += ["--resume", session_id]
    cmd.append(message)

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(SPORE_ROOT))

    try:
        output = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"Bad output: {result.stdout[:200]} | stderr: {result.stderr[:200]}")

    if output.get("is_error"):
        raise RuntimeError(output.get("result", "unknown error"))

    return output["result"], output["session_id"]


async def run_claude(message: str, session_id: str | None) -> tuple[str, str]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_claude, message, session_id)


async def keep_typing(bot, chat_id: int) -> None:
    try:
        while True:
            await bot.send_chat_action(chat_id, "typing")
            await asyncio.sleep(4)
    except asyncio.CancelledError:
        pass


async def send_response(update: Update, text: str) -> None:
    for i in range(0, len(text), 4096):
        await update.message.reply_text(text[i:i + 4096], parse_mode="Markdown")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user.id != ALLOWED_USER_ID:
        return

    session_id = load_session_id()
    typing = asyncio.create_task(keep_typing(context.bot, update.effective_chat.id))

    try:
        try:
            response, new_session_id = await run_claude(update.message.text, session_id)
        except RuntimeError:
            response, new_session_id = await run_claude(update.message.text, None)

        save_session_id(new_session_id)
        log_message("user", update.message.text)
        log_message("assistant", response)
        await send_response(update, response)
    except Exception as e:
        await update.message.reply_text(f"[error: {e}]")
    finally:
        typing.cancel()


async def _handle_image(update: Update, file_id: str, suffix: str, caption: str) -> None:
    tg_file = await update.get_bot().get_file(file_id)

    tmp_dir = SPORE_ROOT / "data" / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=suffix, dir=tmp_dir, delete=False) as tmp:
        tmp_path = Path(tmp.name)
    await tg_file.download_to_drive(str(tmp_path))

    message = f"{caption}\n\n[Image saved at {tmp_path}. Use the Read tool to view it.]"
    session_id = load_session_id()
    typing = asyncio.create_task(keep_typing(update.get_bot(), update.effective_chat.id))

    try:
        try:
            response, new_session_id = await run_claude(message, session_id)
        except RuntimeError:
            response, new_session_id = await run_claude(message, None)

        save_session_id(new_session_id)
        log_message("user", f"[image] {caption}")
        log_message("assistant", response)
        await send_response(update, response)
    except Exception as e:
        await update.message.reply_text(f"[error: {e}]")
    finally:
        typing.cancel()
        tmp_path.unlink(missing_ok=True)


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    caption = update.message.caption or "I sent you an image."
    photo = update.message.photo[-1]  # highest resolution
    await _handle_image(update, photo.file_id, ".jpg", caption)


async def handle_document_image(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    doc = update.message.document
    caption = update.message.caption or "I sent you an image."
    suffix = Path(doc.file_name or "image.jpg").suffix or ".jpg"
    await _handle_image(update, doc.file_id, suffix, caption)


async def handle_new(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    clear_session_id()
    insert_divider()
    await update.message.reply_text("Fresh session.")


async def handle_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    session_id = load_session_id()
    status = f"Session: {session_id}" if session_id else "No active session."
    await update.message.reply_text(status)


async def handle_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    import traceback
    print(f"[error] {context.error}\n{''.join(traceback.format_exception(type(context.error), context.error, context.error.__traceback__))}", flush=True)


def main() -> None:
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("new", handle_new))
    app.add_handler(CommandHandler("status", handle_status))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.Document.IMAGE, handle_document_image))
    app.add_error_handler(handle_error)
    print("Mycel Telegram bot is awake.", flush=True)
    app.run_polling()


if __name__ == "__main__":
    main()
