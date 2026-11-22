// The panel that holds lists and details: a floating card on the left on wide screens and a
// draggable bottom sheet (peek / half / full) on phones, like Apple Maps.
import { icon } from './icons.ts';

type Snap = 'peek' | 'half' | 'full';

export class Sheet {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private head: HTMLElement;
  private titleEl: HTMLElement;
  private subEl: HTMLElement;
  private backBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private stack: { render: () => void }[] = [];
  private snap: Snap = 'peek';
  onClose: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'sheet glass';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<div class="sheet-grip" aria-hidden="true"><span></span></div>
      <header class="sheet-head"><button class="icon-btn sheet-back" type="button" aria-label="Volver" hidden></button>
      <div class="sheet-titles"><h2 class="sheet-title"></h2><p class="sheet-sub"></p></div>
      <button class="icon-btn sheet-close" type="button" aria-label="Cerrar" hidden></button></header>
      <div class="sheet-body"></div>`;
    parent.append(this.el);
    this.head = this.el.querySelector('.sheet-head')!;
    this.titleEl = this.el.querySelector('.sheet-title')!;
    this.subEl = this.el.querySelector('.sheet-sub')!;
    this.body = this.el.querySelector('.sheet-body')!;
    this.backBtn = this.el.querySelector('.sheet-back')!;
    this.closeBtn = this.el.querySelector('.sheet-close')!;
    this.backBtn.append(icon('chevronLeft', 22));
    this.closeBtn.append(icon('x', 18));
    this.backBtn.addEventListener('click', () => this.back());
    this.closeBtn.addEventListener('click', () => this.close());
    this.drag();
  }

  /** Show content. `push` keeps the previous view for the back button. */
  show(title: string, sub: string, content: HTMLElement | string, opts: { push?: boolean; snap?: Snap; closable?: boolean } = {}): HTMLElement {
    const render = () => {
      this.titleEl.textContent = title;
      this.subEl.textContent = sub;
      this.subEl.hidden = !sub;
      this.body.replaceChildren();
      if (typeof content === 'string') this.body.innerHTML = content;
      else this.body.append(content);
      this.body.scrollTop = 0;
      this.backBtn.hidden = this.stack.length < 2;
      this.closeBtn.hidden = opts.closable === false;
    };
    if (opts.push) this.stack.push({ render });
    else this.stack = [{ render }];
    render();
    this.el.classList.add('open');
    this.setSnap(opts.snap ?? (this.isMobile() ? 'half' : 'full'));
    return this.body;
  }

  back(): void {
    if (this.stack.length < 2) return this.close();
    this.stack.pop();
    this.stack[this.stack.length - 1]!.render();
  }

  close(): void {
    this.stack = [];
    this.el.classList.remove('open');
    this.onClose();
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  get depth(): number {
    return this.stack.length;
  }

  isMobile(): boolean {
    return matchMedia('(max-width: 720px)').matches;
  }

  setSnap(s: Snap): void {
    this.snap = s;
    this.el.dataset.snap = s;
  }

  private drag(): void {
    const grip = this.el.querySelector<HTMLElement>('.sheet-grip')!;
    let y0 = 0;
    let h0 = 0;
    let dragging = false;
    const start = (e: PointerEvent) => {
      if (!this.isMobile() || (e.target as HTMLElement).closest('button')) return;
      dragging = true;
      y0 = e.clientY;
      h0 = this.el.getBoundingClientRect().height;
      this.el.classList.add('dragging');
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const h = Math.max(80, Math.min(window.innerHeight - 70, h0 + (y0 - e.clientY)));
      this.el.style.height = `${h}px`;
    };
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      this.el.classList.remove('dragging');
      const h = this.el.getBoundingClientRect().height;
      this.el.style.height = '';
      const vh = window.innerHeight;
      const moved = Math.abs(e.clientY - y0) > 6;
      if (!moved) return this.setSnap(this.snap === 'peek' ? 'half' : this.snap === 'half' ? 'full' : 'half');
      if (h < vh * 0.22) this.setSnap('peek');
      else if (h < vh * 0.62) this.setSnap('half');
      else this.setSnap('full');
    };
    for (const el of [grip, this.head]) {
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
  }
}
