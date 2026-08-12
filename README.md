# Frappe Copilot

Ask natural-language questions about your Frappe / ERPNext data and get clear,
conversational answers. Point it at any Frappe site via an API key/secret —
no Frappe-side install required.

This is a from-scratch rebuild of the original Lovable/Supabase prototype:
same UI and behavior, but the backend is now three small Vercel Functions
that call the OpenAI API directly. No Supabase, no Lovable AI gateway, no
third-party account required beyond an OpenAI key and a Vercel account.

## How it works

- **Frontend** — React + Vite + TypeScript + Tailwind + shadcn/ui. Your Frappe
  connection (site URL, API key, API secret) and chat history are stored in
  the browser's `localStorage` only — there is no database and no user
  accounts. Nothing about your data ever touches a server you don't control,
  other than the two hops described below.
- **`/api/test-connection`** — validates your API key/secret against your
  Frappe site and detects whether HRMS, ERPNext, or both are installed.
- **`/api/frappe-hr-agent`** — the core Q&A loop:
  1. OpenAI turns your question into a structured ERPNext query (doctype,
     filters, fields) using function calling.
  2. The function calls your Frappe site's REST API
     (`/api/resource/<doctype>`) directly with your token, from Vercel's
     servers.
  3. OpenAI turns the raw JSON result into a readable answer.
- **`/api/frappe-code-gen`** — generates Frappe Server Scripts, Client
  Scripts, Print Formats, or Web Page code on request (ported over, not
  currently wired to a button in the UI — see "Extending" below).

Your Frappe API key/secret and question text are sent to: your Frappe site
(to run the query) and OpenAI (to plan the query and phrase the answer).
They are never stored anywhere outside your browser.

## Prerequisites

- Node.js 18+
- A Frappe or ERPNext site with an API key + secret
  (Frappe Desk → your user → **API Access** → **Generate Keys**)
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [Vercel](https://vercel.com) account (free tier is fine)

## Local development

```bash
npm install

# the API functions need an OpenAI key even locally
cp .env.example .env
# edit .env and set OPENAI_API_KEY=sk-...
```

Vercel's functions don't run under plain `vite dev`, so for local dev with
working `/api` routes, run two things:

```bash
# terminal 1 — serves the React app + proxies /api to vercel dev (see vite.config.ts)
npm run dev

# terminal 2 — serves the /api functions on port 3000
npx vercel dev --listen 3000
```

The first time you run `vercel dev` it'll ask you to link the project — say
yes to a new project, and it'll read `OPENAI_API_KEY` from your local `.env`.

Then open http://localhost:8080, click the connection status pill in the
header, and enter your Frappe site URL + API key/secret.

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo. Vercel auto-detects
   the Vite frontend and the `/api` functions — no config needed beyond the
   env var below.
3. In **Project Settings → Environment Variables**, add:
   - `OPENAI_API_KEY` = your OpenAI key
   - (optional) `OPENAI_MODEL` = e.g. `gpt-4o` if you want a stronger model
     than the default `gpt-4o-mini`
4. Deploy. Open the live URL, click the connection pill, and connect your
   Frappe site.

That's it — no database to provision, no Supabase project, no separate
backend host.

## Swapping the AI provider

`api/_lib/openai.ts` is the only place that talks to an LLM. It calls the
standard OpenAI Chat Completions format with function calling, which most
providers are compatible with (Groq, OpenRouter, Azure OpenAI, a
self-hosted vLLM/Ollama endpoint that speaks the OpenAI schema, etc.) —
usually just changing the base URL and model name in that one file is
enough. To use Anthropic's native API instead (different request/response
shape), that file would need a rewrite to the Messages API format; ask if
you'd like that version too.

## Extending

- **Wire up code generation**: `api/frappe-code-gen.ts` is ready to go and
  `ChatMessage.tsx` already knows how to render a `codeGen` result — you'd
  just need a UI entry point (e.g. a quick-action button or a `/code`
  command) that posts to `/api/frappe-code-gen` the same way `Index.tsx`
  posts to `/api/frappe-hr-agent`.
- **Write actions**: the current agent is intentionally read-only (Q&A
  only, no create/update/delete) — same as the original. Extending it to
  write data would mean adding new actions to the query-plan tool schema
  and a confirmation step in the UI before calling Frappe with `POST`/`PUT`.

## Project structure

```
api/                      Vercel Functions (Edge runtime)
  _lib/cors.ts             shared CORS headers + JSON response helper
  _lib/openai.ts           OpenAI Chat Completions wrapper
  test-connection.ts        validates Frappe credentials
  frappe-hr-agent.ts        the Q&A agent
  frappe-code-gen.ts        Frappe script generator
src/
  pages/Index.tsx           main chat page
  components/chat/          chat UI (input, messages, sidebar, settings)
  hooks/useConnection.ts    Frappe connection, persisted to localStorage
  hooks/useChatStore.ts     chat history, persisted to localStorage
vercel.json                 SPA rewrites so client-side routing works
```
