export type Message = {
  id: string;
  userId: string;
  username: string;
  type: string;
  body: string;
  meta: Record<string, unknown> | null;
  createdAt: number;
};

export type User = { id: string; username: string };
