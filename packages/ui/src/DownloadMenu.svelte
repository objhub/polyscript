<script lang="ts">
  import type { DownloadItem } from './types';

  interface Props {
    /** What can be downloaded. The order is the order shown. */
    items: DownloadItem[];
    /** A download is in flight: the trigger spins and refuses further clicks. */
    busy?: boolean;
    label?: string;
    /** The trigger's tooltip and accessible name, when `label` is shortened
     *  to fit a toolbar (say "DL"). Defaults to `label`. */
    title?: string;
    /** Tooltip for an item the caller marked unavailable, so the reason for a
     *  greyed-out row is visible rather than guessed at. */
    unavailableHint?: string;
    ondownload: (id: string) => void;
  }

  let {
    items,
    busy = false,
    label = 'Download',
    title = undefined,
    unavailableHint = '',
    ondownload,
  }: Props = $props();

  let open = $state(false);

  function choose(item: DownloadItem) {
    if (item.disabled || busy) return;
    open = false;
    ondownload(item.id);
  }

  /** Clicks outside close the menu. The trigger is inside .download-menu-root,
   *  so it has to be excluded or the click that opens the menu would close it
   *  again on its way up to the window. */
  function onWindowClick(e: MouseEvent) {
    if (!open) return;
    if (!(e.target as Element | null)?.closest('.download-menu-root')) open = false;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="download-menu-root">
  <button
    class="trigger"
    onclick={() => (open = !open)}
    disabled={busy || items.length === 0}
    aria-haspopup="menu"
    aria-expanded={open}
    title={title ?? label}
    aria-label={title ?? label}
  >
    {#if busy}
      <svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    {:else}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    {/if}
    <span class="trigger-label">{label}</span>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if open}
    <div class="menu" role="menu">
      {#each items as item (item.id)}
        <button
          role="menuitem"
          onclick={() => choose(item)}
          disabled={item.disabled}
          title={item.disabled ? unavailableHint : (item.hint ?? '')}
        >
          <span class="fmt">{item.label}</span>
          {#if item.hint}<span class="fmt-hint">{item.hint}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* The trigger takes its colours from the host: this sits on a dark navbar in
     one app and a white toolbar in the other. The menu panel stays light in
     both, which is what a dropdown over a dark bar looks like anyway. */
  .download-menu-root {
    position: relative;
    flex-shrink: 0;
  }
  .trigger {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: var(--dl-padding, 0.3rem 0.6rem);
    border: 1px solid var(--dl-border, #e2e8f0);
    border-radius: var(--dl-radius, 6px);
    background: var(--dl-bg, #fff);
    color: var(--dl-fg, #4a5568);
    font-size: var(--dl-font-size, 0.8rem);
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  .trigger:hover:not(:disabled) {
    background: var(--dl-bg-hover, #edf2f7);
  }
  .trigger:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 190px;
    padding: 0.25rem;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
  }
  .menu button {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border: none;
    border-radius: 6px;
    background: none;
    font-family: inherit;
    font-size: 0.8rem;
    color: #2d3748;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .menu button:hover:not(:disabled) {
    background: #edf2f7;
  }
  .menu button:disabled {
    color: #a0aec0;
    cursor: default;
  }
  .fmt {
    min-width: 2.6rem;
    font-weight: 600;
  }
  .fmt-hint {
    font-size: 0.72rem;
    color: #718096;
  }
  .menu button:disabled .fmt-hint {
    color: #cbd5e0;
  }
  .spin {
    animation: dl-spin 0.8s linear infinite;
  }
  @keyframes dl-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
