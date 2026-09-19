# Wallet Narrative Tracker

Watches one Solana wallet through a Helius enhanced webhook. For qualifying SOL or USDC/USDT swap buys, it looks up the token on DexScreener, asks Grok to search X, and posts a compact narrative to Discord.

## Deploy

1. Create a new GitHub repository called `wallet-narrative-tracker` and upload these files.
2. In Vercel, choose **Add New → Project**, import that GitHub repository, then click **Deploy**.
3. In the deployed project, open **Settings → Environment Variables** and add every value in `.env.example`. Use a long random value for `HELIUS_WEBHOOK_SECRET`.
4. Redeploy once after adding the variables.

Your endpoint will be:

`https://YOUR-VERCEL-PROJECT.vercel.app/api/helius`

## Connect Helius

In Helius, create an Enhanced webhook:

- Transaction type: `SWAP`
- Account address: `VJSDW6S74YXR4rRR9P4xwhMvLZJQMhrUb8XMFirUsy1`
- Webhook URL: your deployed endpoint above
- Header: `Authorization: Bearer YOUR_HELIUS_WEBHOOK_SECRET`

## Discord destination

Create a Discord webhook inside the channel where you want reports: **Edit Channel → Integrations → Webhooks → New Webhook**. Put its copied URL in `DISCORD_WEBHOOK_URL` in Vercel.

Never put an API key in the GitHub files. Only put it in Vercel Environment Variables.
