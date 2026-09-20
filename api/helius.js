const SOL_MINT = "So11111111111111111111111111111111111111112";

const QUOTE_MINTS = new Set([
  SOL_MINT,
  "Es9vMFrzaCERmJfrF4H2FYDqvfZTzDErCH2roKkaZ6e", // USDT
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
]);

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function tokenAmount(transfer) {
  return Number(
    transfer?.rawTokenAmount?.tokenAmount ??
    transfer?.tokenAmount ??
    0
  );
}

async function discordMessage(content) {
  const response = await fetch(env("DISCORD_WEBHOOK_URL"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: content.slice(0, 1900),
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord delivery failed (${response.status})`);
  }
}

function findBoughtToken(event, wallet) {
  const outputs = event?.events?.swap?.tokenOutputs ?? event?.tokenTransfers ?? [];

  return outputs.find((transfer) =>
    !QUOTE_MINTS.has(transfer.mint) &&
    (transfer.userAccount === wallet || transfer.toUserAccount === wallet) &&
    tokenAmount(transfer) > 0
  );
}

async function solPrice() {
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    { headers: { accept: "application/json" } }
  );

  if (!response.ok) throw new Error("Could not price SOL");

  return Number((await response.json())?.solana?.usd);
}

async function buyValueUsd(event) {
  const swap = event?.events?.swap ?? {};

  const native = Number(swap?.nativeInput?.amount ?? 0) / 1e9;
  if (native > 0) return native * await solPrice();

  const stableInput = (swap?.tokenInputs ?? []).find(
    (input) =>
      QUOTE_MINTS.has(input.mint) &&
      input.mint !== SOL_MINT
  );

  if (stableInput) {
    const decimals = Number(stableInput?.rawTokenAmount?.decimals ?? 6);
    return tokenAmount(stableInput) / 10 ** decimals;
  }

  return 0;
}

async function tokenDetails(mint) {
  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${mint}`
  );

  if (!response.ok) return {};

  const pair = (await response.json())?.pairs
    ?.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

  if (!pair) return {};

  return {
    name: pair.baseToken?.name ?? "Unknown",
    symbol: pair.baseToken?.symbol ?? "Unknown",
    liquidityUsd: pair.liquidity?.usd ?? null,
    marketCap: pair.marketCap ?? pair.fdv ?? null,
    url: pair.url ?? null,
  };
}

async function researchOnX({ mint, token, buyUsd }) {
  const prompt = `Research this Solana memecoin on X only.

CA: ${mint}
Name: ${token.name ?? "unknown"}
Ticker: ${token.symbol ?? "unknown"}
Wallet buy size: $${buyUsd.toFixed(2)}

Search the exact CA first. Then search the name and ticker only when it clearly refers to this project.

Give a concise trader-facing report with these exact headings:
Narrative
X traction
What people are saying
Red flags
Verdict

Do not invent facts. Explicitly say when there is little or no X evidence. Keep it under 160 words.`;

  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env("XAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "grok-4.6",
      input: [{ role: "user", content: prompt }],
      tools: [{ type: "x_search" }],
    }),
  });

  if (!response.ok) {
    throw new Error(`xAI research failed (${response.status})`);
  }

  const data = await response.json();

  return (
    data.output_text ??
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n") ??
    "No narrative returned."
  );
}

async function postNarrative({ mint, token, buyUsd, narrative }) {
  const lines = [
    `**Wallet buy detected — $${token.symbol ?? "TOKEN"}**`,
    `Bought: **$${buyUsd.toFixed(2)}**`,
    `CA: \`${mint}\``,
    token.marketCap
      ? `MC: **$${Math.round(token.marketCap).toLocaleString()}**`
      : null,
    token.liquidityUsd
      ? `Liquidity: **$${Math.round(token.liquidityUsd).toLocaleString()}**`
      : null,
    "",
    narrative,
    "",
    `[Open X search](https://x.com/search?q=${encodeURIComponent(mint)}&src=typed_query)${
      token.url ? ` · [DexScreener](${token.url})` : ""
    }`,
  ]
    .filter(Boolean)
    .join("\n");

  await discordMessage(lines);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "wallet-narrative-tracker",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.headers.authorization !== `Bearer ${env("HELIUS_WEBHOOK_SECRET")}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const wallet = env("WATCHED_WALLET");
  const minimum = Number(process.env.MIN_BUY_USD ?? 5);
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];

  for (const event of events) {
    // TEMPORARY DEBUG: proves Discord receives each real Helius webhook.
    await discordMessage(
      `✅ Webhook received\nType: **${event.type ?? "unknown"}**\nSignature: \`${event.signature ?? "unknown"}\``
    );

    if (event.type !== "SWAP") {
      await discordMessage("Skipped: transaction is not a SWAP.");
      continue;
    }

    if (!event.accountData?.some((account) => account.account === wallet)) {
      await discordMessage("Skipped: watched wallet was not found in this event.");
      continue;
    }

    const bought = findBoughtToken(event, wallet);

    if (!bought) {
      await discordMessage("Skipped: could not identify the purchased token.");
      continue;
    }

    const buyUsd = await buyValueUsd(event).catch(() => 0);

    if (buyUsd < minimum) {
      await discordMessage(
        `Skipped: detected buy value was $${buyUsd.toFixed(2)}, below $${minimum}.`
      );
      continue;
    }

    const token = await tokenDetails(bought.mint);
    const narrative = await researchOnX({
      mint: bought.mint,
      token,
      buyUsd,
    });

    await postNarrative({
      mint: bought.mint,
      token,
      buyUsd,
      narrative,
    });

    results.push({
      mint: bought.mint,
      symbol: token.symbol,
      buyUsd,
    });
  }

  return res.status(200).json({ ok: true, researched: results });
}
