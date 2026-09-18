import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { isTauri } from "@/lib/ai";
import { useT, type TFunction } from "@/providers/I18nProvider";
import type { TranslationKey } from "@/locales/en";

interface Source {
  /** Untranslated where the name is a proper noun that is not translated. */
  name: string | TranslationKey;
  url: string;
  used: TranslationKey;
  license: TranslationKey;
}

/**
 * The attribution list.
 *
 * The names stay as keys rather than literals only where a name genuinely
 * changes across languages — "Quran.com API" does not, "Tafsir Ibn Kathir
 * (abridged, English)" does, because the parenthetical is a description.
 */
const SOURCES: Source[] = [
  {
    name: "Quran.com API (v4)",
    url: "https://api-docs.quran.foundation",
    used: "about.quranApi.used",
    license: "about.quranApi.license",
  },
  {
    name: "about.saheeh.name",
    url: "https://quran.com",
    used: "about.saheeh.used",
    license: "about.saheeh.license",
  },
  {
    name: "about.kuliev.name",
    url: "https://quran.com",
    used: "about.kuliev.used",
    license: "about.kuliev.license",
  },
  {
    name: "about.sodiq.name",
    url: "https://quran.com",
    used: "about.sodiq.used",
    license: "about.sodiq.license",
  },
  {
    name: "about.ibnKathir.name",
    url: "https://github.com/spa5k/tafsir_api",
    used: "about.ibnKathir.used",
    license: "about.ibnKathir.license",
  },
  {
    name: "about.mukhtasar.name",
    url: "https://github.com/spa5k/tafsir_api",
    used: "about.mukhtasar.used",
    license: "about.mukhtasar.license",
  },
  {
    name: "Ollama Cloud",
    url: "https://ollama.com",
    used: "about.ollama.used",
    license: "about.ollama.license",
  },
  {
    name: "Amiri Quran & Inter",
    url: "https://fonts.google.com/specimen/Amiri+Quran",
    used: "about.fonts.used",
    license: "about.fonts.license",
  },
];

/** A source name is either a proper noun or a key; keys carry a dot. */
function sourceName(source: Source, t: TFunction): string {
  return source.name.includes(".") ? t(source.name as TranslationKey) : source.name;
}

function SourceLink({ source }: { source: Source }) {
  const t = useT();
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <button
        onClick={() => {
          if (isTauri()) void openUrl(source.url);
          else window.open(source.url, "_blank", "noopener");
        }}
        className="group inline-flex items-center gap-1.5 text-sm font-medium text-fg transition-colors hover:text-accent"
      >
        {sourceName(source, t)}
        <ExternalLink
          className="size-3 text-fg-subtle transition-colors group-hover:text-accent"
          aria-hidden
        />
      </button>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">{t(source.used)}</p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">{t(source.license)}</p>
    </div>
  );
}

export function About() {
  const t = useT();

  return (
    <Page title={t("about.title")} description={t("about.description")}>
      <div className="space-y-4">
        <Card>
          <CardHeader title={t("about.howTitle")} description={t("about.howDescription")} />
          <CardBody>
            <p className="prose-reading text-[0.875rem]">{t("about.howBody")}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("about.sourcesTitle")}
            description={t("about.sourcesDescription")}
          />
          <CardBody>
            <div className="divide-y divide-border">
              {SOURCES.map((source) => (
                <SourceLink key={`${source.name}${source.used}`} source={source} />
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("about.tafsirNoteTitle")} />
          <CardBody>
            <p className="prose-reading text-[0.875rem]">{t("about.tafsirNoteBody")}</p>
            <p className="prose-reading mt-3 text-[0.875rem]">{t("about.aiNoteBody")}</p>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
