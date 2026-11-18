-- Thesis read cache. The chain is the source of truth; every row here can be
-- rebuilt by the indexer from chain data (spec section 7).
-- Amounts are USDC micro-units (6 dp); prices are Pyth units (price * 10^expo).

create table if not exists markets (
  touch_market        text primary key,          -- Thesis TouchMarket PDA
  pm_market           text not null unique,      -- pm-AMM market
  market_id           numeric(20) not null,
  feed_id             text not null,             -- hex
  direction           text not null check (direction in ('above', 'below')),
  strike              bigint not null,
  expo                int not null,
  spot_at_open        bigint not null,
  start_ts            bigint not null,
  end_ts              bigint not null,
  initial_price_bps   int not null,
  yes_price_bps       int,                       -- latest pool price
  seed_usdc           bigint not null,
  seeded_by           text not null,
  sponsored           boolean not null,
  creator             text not null,
  origin_thesis       text,
  touched             boolean not null default false,
  touch_price         bigint,
  touch_publish_time  bigint,
  prover              text,
  proof_tx            text,
  settled             boolean not null default false,
  winning_side        smallint not null default 0, -- 0 open, 1 YES, 2 NO
  created_tx          text,
  settle_tx           text,
  updated_at          timestamptz not null default now()
);
create index if not exists markets_open_idx on markets (settled, end_ts);
create index if not exists markets_thesis_idx on markets (origin_thesis);

create table if not exists theses (
  pda                 text primary key,
  creator             text not null,
  thesis_id           bigint not null,
  text                text,                      -- set via the API, checked against text_hash
  text_hash           text not null,             -- hex sha256
  conviction_market   text not null,
  protection_market   text,
  created_ts          bigint not null,
  end_ts              bigint not null,
  volume_usdc         bigint not null default 0,
  self_volume_usdc    bigint not null default 0,
  fees_attributed     bigint not null default 0,
  fees_claimed        bigint not null default 0,
  outcome             smallint not null default 0, -- 0 open, 1 hit, 2 missed
  created_tx          text,
  updated_at          timestamptz not null default now(),
  unique (creator, thesis_id)
);
create index if not exists theses_creator_idx on theses (creator);
create index if not exists theses_end_idx on theses (end_ts);

create table if not exists trades (
  signature           text not null,
  ix_index            int not null,
  touch_market        text not null,
  thesis              text,                      -- null for direct pm-AMM swaps
  wallet              text not null,
  side                text not null check (side in ('buy_yes', 'buy_no', 'sell_yes', 'sell_no', 'other')),
  usdc_amount         bigint not null,
  token_amount        bigint not null,
  fee_to_treasury     bigint not null default 0,
  price_after_bps     int,
  ts                  bigint not null,
  via_thesis          boolean not null,
  is_creator          boolean not null default false,
  is_treasury         boolean not null default false,
  primary key (signature, ix_index)
);
create index if not exists trades_market_idx on trades (touch_market, ts desc);
create index if not exists trades_thesis_idx on trades (thesis, ts desc);
create index if not exists trades_wallet_idx on trades (wallet);

create table if not exists crossings (
  id                  bigserial primary key,
  touch_market        text not null,
  feed_id             text not null,
  publish_time        bigint not null,
  price               bigint not null,
  proof_tx            text not null unique,
  prover              text not null
);

create table if not exists price_points (
  touch_market        text not null,
  ts                  bigint not null,
  yes_price_bps       int not null,
  primary key (touch_market, ts)
);

create table if not exists spot_samples (
  feed_id             text not null,
  publish_time        bigint not null,
  price               bigint not null,
  expo                int not null,
  primary key (feed_id, publish_time)
);

create table if not exists profiles (
  wallet              text primary key,
  display_name        text,
  x_handle            text,                      -- self-declared, unverified
  updated_at          timestamptz not null default now()
);

create table if not exists fee_claims (
  signature           text primary key,
  thesis              text not null,
  creator             text not null,
  amount              bigint not null,
  ts                  bigint not null
);

create table if not exists indexer_cursors (
  key                 text primary key,          -- e.g. 'program', 'pm:<market>'
  last_signature      text not null,
  updated_at          timestamptz not null default now()
);

-- Per-creator numbers for profiles (spec: raw numbers only, no accuracy score).
create or replace view creator_stats as
select
  t.creator,
  count(*)                                        as posted,
  count(*) filter (where t.outcome = 1)           as hit,
  count(*) filter (where t.outcome = 2)           as missed,
  coalesce(sum(t.volume_usdc), 0)::bigint         as volume_usdc,
  coalesce(sum(t.self_volume_usdc), 0)::bigint    as self_volume_usdc,
  coalesce(sum(t.fees_attributed), 0)::bigint     as fees_attributed,
  coalesce(sum(t.fees_claimed), 0)::bigint        as fees_claimed,
  coalesce(avg(m.initial_price_bps), 0)::int      as avg_opening_bps
from theses t
left join markets m on m.touch_market = t.conviction_market
group by t.creator;

create table if not exists schema_migrations (
  version             text primary key,
  applied_at          timestamptz not null default now()
);
