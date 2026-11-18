-- Telegram alerts: wallets linked to a Telegram chat, short-lived link codes,
-- and a log of alerts already sent (each alert is recorded before it is sent,
-- so a worker restart never repeats one).
create table if not exists telegram_links (
  wallet      text primary key,
  chat_id     bigint not null,
  username    text,
  linked_at   timestamptz not null default now()
);
create index if not exists telegram_links_chat_idx on telegram_links (chat_id);

create table if not exists telegram_link_codes (
  code        text primary key,
  wallet      text not null,
  expires_at  timestamptz not null
);

create table if not exists alerts_sent (
  key         text primary key,
  sent_at     timestamptz not null default now()
);
