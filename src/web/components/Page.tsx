import type { ReactNode } from "react";

export function Page({
  eyebrow,
  title,
  description,
  actions,
  children,
  wide = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className={wide ? "page page--wide" : "page"}>
      <header className="page-header">
        <div className="page-header__copy">
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}
