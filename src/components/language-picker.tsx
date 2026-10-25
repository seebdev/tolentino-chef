"use client";
import { copy, languages } from "@/lib/i18n";
export function LanguagePicker({
  enabled = languages,
  value,
  onChange,
}: {
  enabled?: typeof languages;
  value: string;
  onChange: (code: string) => void;
}) {
  const t = copy[value] || copy.es;
  return (
    <div className="language-picker">
      <div className="language-flags" role="group" aria-label={t.language}>
        {enabled.map((l) => (
          <button
            key={l.code}
            type="button"
            aria-label={l.label}
            title={l.label}
            aria-pressed={value === l.code}
            className={"language-flag " + (value === l.code ? "active" : "")}
            data-language={l.code}
            onClick={() => onChange(l.code)}
          >
            <img src={l.flag} alt="" width={28} height={21} />
          </button>
        ))}
      </div>
      <label className="language-choice">
        <span className="sr-only">{t.language}</span>
        <select
          aria-label={t.language}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {enabled.map((l) => (
            <option value={l.code} key={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
