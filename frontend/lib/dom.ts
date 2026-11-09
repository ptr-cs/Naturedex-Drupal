export function one<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function all<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Clones the contents of a server-rendered <template>. */
export function fromTemplate(selector: string): DocumentFragment {
  return one<HTMLTemplateElement>(selector).content.cloneNode(
    true,
  ) as DocumentFragment;
}

/** Creates an element. Text always goes through textContent, so it cannot become markup. */
export function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function readJson<T>(id: string): T {
  return JSON.parse(one(`#${id}`).textContent || 'null') as T;
}
