<script lang="ts">
  interface Props {
    /** What to say. Empty renders an empty bar, not a collapsed one: the
     *  editor below it must not move when a message arrives. */
    text?: string;
    /** A build or an export failed. Red is for this and nothing else --
     *  "Building..." is progress, not a failure. */
    error?: boolean;
    /** Something is running. Shows the spinner and the amber ground. */
    busy?: boolean;
    /** Standing note rather than the result of an action (a stale artifact,
     *  say). Greyed, and never shown while `text` has something to say. */
    muted?: string;
    /** A link after the text, for where to go next (the language reference
     *  under a build error, say). Shown only alongside `text`. Opens in a new
     *  tab: the bar sits under an editor with unsaved work. */
    link?: { href: string; label: string } | null;
  }

  let { text = '', error = false, busy = false, muted = '', link = null }: Props = $props();
</script>

<div class="status-bar" class:error class:busy>
  {#if busy}<span class="spinner">⏳</span>{/if}
  {#if text}
    <span class="status-text">{text}</span>
    {#if link}
      <a class="status-link" href={link.href} target="_blank" rel="noopener">{link.label} ↗</a>
    {/if}
  {:else if muted}
    <span class="status-text muted">{muted}</span>
  {/if}
</div>

<style>
  /* Both apps show this under the editor and mean the same three states by
     it, so the colours and the sizing live here rather than being written
     twice and drifting. A host that needs different metrics can set the
     custom properties; the state colours are deliberately not overridable. */
  .status-bar {
    flex-shrink: 0;
    min-height: var(--sb-min-height, 22px);
    max-height: var(--sb-max-height, 4.5rem);
    padding: var(--sb-padding, 3px 10px);
    border-top: 1px solid #e2e8f0;
    background: #f7fafc;
    color: #2d3748;
    font-family: var(--sb-font-family, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--sb-font-size, 12px);
    /* Errors run to several lines (a parse error per line); the bar grows to
       max-height and scrolls rather than truncating what went wrong. */
    overflow-y: auto;
  }
  .status-bar.error {
    background: #fff5f5;
    color: #c53030;
  }
  /* :not(.error) so a failure stays red even when a second build is already
     in flight and has raised the busy flag again. */
  .status-bar.busy:not(.error) {
    background: #fffaf0;
    color: #b7791f;
  }
  .status-text {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .status-link {
    margin-left: 0.75em;
    color: #3182ce;
    white-space: nowrap;
  }
  .status-text.muted {
    color: #a0aec0;
  }
  .spinner {
    margin-right: 4px;
  }
</style>
