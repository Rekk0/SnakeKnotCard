import type { Session } from "../shared/types";
export async function api<T>(
  path: string,
  session: Session | null = null,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(path, {
    method:
      method === undefined ? (body === undefined ? "GET" : "POST") : method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : `请求失败（${response.status}）`,
    );
  return result as T;
}
export async function uploadAvatar(
  code: string,
  session: Session,
  file: File,
  matchId: string,
) {
  const form = new FormData();
  form.append("avatar", file);
  const response = await fetch(`/api/rooms/${code}/avatar`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "X-Match-Id": matchId,
    },
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as { avatar: string };
}
