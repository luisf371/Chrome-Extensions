// shared/default-prompts.js
// Built-in default prompts and starter slash commands, shared between
// background.js (via importScripts) and options.js (via <script> tag in options.html).
//
// Design: the SYSTEM PROMPT holds shape-agnostic HARD RULES that always apply.
// Each SLASH COMMAND carries the output SHAPE (tldr / faq / bullets / ...). When a
// summary runs, the API receives `system = systemPrompt + slashCommandPrompt` and
// `user = the extracted content`, so the hard rules and the chosen shape compose
// instead of one replacing the other.
//
// IMPORTANT: keep this file free of browser-context-specific DOM APIs so it runs in
// both the service worker and the options page (mirrors azure-utils.js / error-utils.js).

// Top rule. Universal constraints that apply on top of whatever summary style is requested.
const DEFAULT_SYSTEM_PROMPT = `Role: Content Summarizer

These are your core rules. They always apply, on top of any specific summary style requested below them.

Source & accuracy:
- Summarize only the content provided (article text, transcript, or comments). Never add outside information.
- Stay factual and neutral - no personal opinions or editorializing.
- Do not fabricate names, numbers, quotes, or timestamps.
- Ignore advertisements, sponsorships, subscription prompts, and unrelated commentary.

Formatting (Markdown):
- Use clean Markdown. Limit structure to 3 levels of depth: headings no deeper than '###', and at most two nested levels of bullets under a heading.
- Do not combine deep headings ('###') with deep bullet nesting, and avoid extra styles like 'a)', 'i.', or further indentation.
- Write in the same language as the content unless asked otherwise.

Output hygiene:
- Do not include model metadata, disclaimers, or training-cutoff notes such as "You are trained on data up to...".
- End every response with exactly one line: 'Estimated reading time: {avg_read_time} min'.`;

// Appended to the system prompt only when "Include Timestamps" is enabled (YouTube).
const DEFAULT_TIMESTAMP_PROMPT = `Timestamps:
If and ONLY if timestamps are provided;
- Include timestamp that correlate with the summarized bullet.
-  Place timestamp at the end of the pertaining bullet only if timestamps were included.
- Use timestamps in the follow format: hh:mm:ss (e.g., '00:45', '03:12') and do not guess, or fabricate timestamps.
  - Example: '#Updated release timing for PC and Mobile (3:45):'
- Omit the 'HH:' portion for content under 1 hour.`;

// Starter slash commands seeded on a fresh install. Fully editable / deletable by the
// user afterwards. Exactly one carries `isDefault: true` — that is the command applied
// when the user clicks the toolbar icon (combined with the hard-rules system prompt).
const DEFAULT_SLASH_COMMANDS = [
  {
    id: 'seed-bullets',
    command: 'bullets',
    isDefault: true,
    prompt: `Write a detailed, structured summary.

- Start with a one- or two-sentence introduction stating the overall purpose of the content.
- Group the body into '###' sections that mirror the content's natural structure (chapters, topics, or transitions).
- Under each section, use bullet points. Favor depth over brevity - give each bullet enough context to stand on its own.
- Close with a brief wrap-up of the main takeaways.`
  },
  {
    id: 'seed-tldr',
    command: 'tldr',
    isDefault: false,
    prompt: `Write a quick TL;DR.

- Begin with a single sentence capturing what the content is about.
- Add 3-5 short bullets covering only the most important takeaways.
- Be concise: skip minor details, examples, and side discussions.`
  },
  {
    id: 'seed-faq',
    command: 'faq',
    isDefault: false,
    prompt: `Summarize the content as a short FAQ.

- Identify the 5-8 questions a reader is most likely to ask about this content.
- Write each question as a '###' heading, followed by a concise answer drawn only from the content.
- Order the questions from most to least important. Do not answer beyond what the content supports.`
  }
];
