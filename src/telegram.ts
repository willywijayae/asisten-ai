// Tipe minimal dari Telegram Bot API yang dipakai bot ini.
export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  date: number;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; duration: number; file_name?: string };
  photo?: { file_id: string; width: number; height: number }[];
  forward_origin?: {
    type: string;
    sender_user?: TgUser;
    sender_user_name?: string;
    chat?: { title?: string };
  };
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export type InlineKeyboard = { text: string; callback_data: string }[][];

export class Telegram {
  constructor(private token: string) {}

  async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method} gagal: ${json.description}`);
    return json.result;
  }

  /** Kirim teks biasa (tanpa parse_mode supaya aman), dipecah per 4000 karakter. */
  async send(chatId: number | string, text: string, keyboard?: InlineKeyboard): Promise<void> {
    const chunks = splitText(text || "(kosong)", 4000);
    for (let i = 0; i < chunks.length; i++) {
      const last = i === chunks.length - 1;
      await this.call("sendMessage", {
        chat_id: chatId,
        text: chunks[i],
        link_preview_options: { is_disabled: true },
        ...(last && keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      });
    }
  }

  async typing(chatId: number | string): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  }

  async editText(chatId: number | string, messageId: number, text: string): Promise<void> {
    await this.call("editMessageText", { chat_id: chatId, message_id: messageId, text }).catch(() => {});
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {});
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const file = await this.call<{ file_path: string }>("getFile", { file_id: fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
    if (!res.ok) throw new Error(`Gagal download file Telegram: ${res.status}`);
    return res.arrayBuffer();
  }
}

function splitText(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  out.push(rest);
  return out;
}
