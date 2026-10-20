import { ItemView, WorkspaceLeaf } from 'obsidian';
import { captureScrollState, restoreScrollState } from './scroll-state.ts';

export interface ReadingServices {
  refreshViews(): Promise<void>;
  watchSourceUpdates(listener: (message: string) => void, notePath: () => string | null): () => void;
}

/** Background checks never replace a reader's DOM; redraws are explicit. */
export abstract class ReadingView extends ItemView {
  private releaseUpdates: (() => void) | null = null;
  private pendingMessage: string | null = null;
  private updateVersion = 0;
  private renderedContext: string | null = null;
  private refreshing: Promise<void> | null = null;
  private activeContext = '';
  private refreshAgain = false;
  private noticeEl: HTMLElement | null = null;
  private scrollVersion = 0;
  private readingClosed = false;

  constructor(leaf: WorkspaceLeaf, private readingServices: ReadingServices) { super(leaf); }

  protected abstract refreshContent(): Promise<void>;
  protected scrollContext(): string { return this.getViewType(); }
  protected sourceNotePath(): string | null { return null; }

  protected startReadingUpdates(): void {
    this.readingClosed = false;
    this.releaseUpdates ??= this.readingServices.watchSourceUpdates(
      (message) => this.markDataUpdated(message), () => this.sourceNotePath(),
    );
  }

  protected stopReadingUpdates(): void {
    this.readingClosed = true;
    this.releaseUpdates?.();
    this.releaseUpdates = null;
    this.scrollVersion++;
    this.noticeEl?.remove();
    this.noticeEl = null;
  }

  markDataUpdated(message = 'Updated data available'): void {
    this.pendingMessage = message;
    this.updateVersion++;
    this.renderUpdateNotice();
  }

  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain ||= this.scrollContext() !== this.activeContext;
      return this.refreshing;
    }
    const run = async (): Promise<void> => {
      do {
        this.refreshAgain = false;
        this.activeContext = this.scrollContext();
        const scrollVersion = ++this.scrollVersion;
        const version = this.updateVersion;
        const positions = this.renderedContext === this.activeContext ? captureScrollState(this.contentEl) : [];
        await this.refreshContent();
        if (this.readingClosed) return;
        this.renderedContext = this.scrollContext();
        // Report renderers initialize their own timelines on an animation frame.
        // Restore afterwards, and never let an older frame affect a newer page.
        const renderedContext = this.renderedContext;
        restoreScrollState(this.contentEl, positions);
        window.requestAnimationFrame(() => {
          if (scrollVersion === this.scrollVersion && this.scrollContext() === renderedContext) {
            restoreScrollState(this.contentEl, positions);
          }
        });
        if (version === this.updateVersion) this.pendingMessage = null;
        this.renderUpdateNotice();
      } while (this.refreshAgain && !this.readingClosed);
    };
    this.refreshing = run().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private renderUpdateNotice(): void {
    this.containerEl.addClass('examined-human-reading-host');
    if (this.noticeEl?.isConnected) this.noticeEl.remove();
    this.noticeEl = null;
    if (!this.pendingMessage) return;
    const notice = this.containerEl.createDiv({
      cls: 'examined-human-update-notice', attr: { role: 'status', 'aria-live': 'polite' },
    });
    notice.createSpan({ text: `${this.pendingMessage}. Your current display is unchanged. ` });
    const button = notice.createEl('button', { text: 'Refresh' });
    button.addEventListener('click', () => {
      button.disabled = true;
      void this.readingServices.refreshViews().finally(() => { button.disabled = false; });
    });
    this.noticeEl = notice;
  }
}
