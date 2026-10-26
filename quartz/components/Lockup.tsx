import { pathToRoot } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"

// Lockup wording is an open decision (see README / devlog for the human review
// note). Both compact variants are implemented; flip this constant to compare
// them in a local build.
// Variant "a" (shipped default): "Cortex" wordmark, small "by RS42" byline underneath.
// Variant "b" (alternative):      "RS42.ai × Cortex" as a single inline lockup.
const LOCKUP_VARIANT: "a" | "b" = "a"

const Lockup: QuartzComponent = ({ fileData, cfg, displayClass }: QuartzComponentProps) => {
  const title = cfg?.pageTitle ?? i18n(cfg.locale).propertyDefaults.title
  const baseDir = pathToRoot(fileData.slug!)

  if ((LOCKUP_VARIANT as string) === "b") {
    return (
      <div class={classNames(displayClass, "lockup", "lockup-b")}>
        <h2 class="page-title">
          <a href="https://rs42.ai" target="_blank" rel="noopener noreferrer">
            RS42.ai
          </a>
          <span class="lockup-sep">×</span>
          <a href={baseDir}>{title}</a>
        </h2>
      </div>
    )
  }

  return (
    <div class={classNames(displayClass, "lockup", "lockup-a")}>
      <h2 class="page-title">
        <a href={baseDir}>{title}</a>
      </h2>
      <a class="lockup-byline" href="https://rs42.ai" target="_blank" rel="noopener noreferrer">
        by RS42
      </a>
    </div>
  )
}

Lockup.css = `
.lockup {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.lockup .page-title {
  font-size: 1.75rem;
  margin: 0;
  font-family: var(--titleFont);
}

.lockup-byline {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--gray);
  text-decoration: none;
  width: fit-content;
}

.lockup-byline:hover {
  color: var(--secondary);
}

.lockup-b .page-title {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.lockup-b .lockup-sep {
  color: var(--gray);
  font-size: 1.1rem;
}
`

export default (() => Lockup) satisfies QuartzComponentConstructor
