import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { isTauri } from "@/lib/ai";

interface Source {
  name: string;
  url: string;
  used: string;
  license: string;
}

const SOURCES: Source[] = [
  {
    name: "Quran.com API (v4)",
    url: "https://api-docs.quran.foundation",
    used: "Uthmani Arabic text, ruku and juz boundaries, and the word-by-word breakdown with transliteration and English glosses.",
    license:
      "Provided by Quran.com / Quran Foundation for non-commercial use. Data imported once and served locally.",
  },
  {
    name: "Saheeh International translation",
    url: "https://quran.com",
    used: "The English translation shown beneath every ayah.",
    license: "© Saheeh International. Reproduced for personal study.",
  },
  {
    name: "Tafsir Ibn Kathir (abridged, English)",
    url: "https://github.com/spa5k/tafsir_api",
    used: "The commentary in the reader's tafsir panel, mapped to ayah ranges.",
    license:
      "Public-domain classical text; JSON mirror published by the tafsir_api project under MIT.",
  },
  {
    name: "Ollama Cloud",
    url: "https://ollama.com",
    used: "Generates the per-word contextual explanations and ruku summaries, which are then cached and shared.",
    license: "Used under your own Ollama Cloud account and its terms.",
  },
  {
    name: "Amiri Quran & Inter",
    url: "https://fonts.google.com/specimen/Amiri+Quran",
    used: "The Quranic Arabic typeface and the interface typeface.",
    license: "SIL Open Font License 1.1. Bundled with the app.",
  },
];

function SourceLink({ source }: { source: Source }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <button
        onClick={() => {
          if (isTauri()) void openUrl(source.url);
          else window.open(source.url, "_blank", "noopener");
        }}
        className="group inline-flex items-center gap-1.5 text-sm font-medium text-fg transition-colors hover:text-accent"
      >
        {source.name}
        <ExternalLink
          className="size-3 text-fg-subtle transition-colors group-hover:text-accent"
          aria-hidden
        />
      </button>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">{source.used}</p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">{source.license}</p>
    </div>
  );
}

export function About() {
  return (
    <Page
      title="About & sources"
      description="Where the text in this app comes from, and who to credit for it."
    >
      <div className="space-y-4">
        <Card>
          <CardHeader
            title="How this app works"
            description="Quran Studio organises the Quran into its 558 rukus and treats each one as a lesson."
          />
          <CardBody>
            <p className="prose-reading text-[0.875rem]">
              All Quran text, translation, word-by-word data, and tafsir are imported once into
              your own Supabase project and read from there. The app never calls a third-party
              Quran API while you use it, so it stays fast and works from a single database you
              control. AI explanations are generated on demand, then cached so each one is
              produced only once and reused afterwards.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Sources & attribution"
            description="Please respect each source's own terms if you redistribute this app."
          />
          <CardBody>
            <div className="divide-y divide-border">
              {SOURCES.map((source) => (
                <SourceLink key={source.name} source={source} />
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="A note on the tafsir" />
          <CardBody>
            <p className="prose-reading text-[0.875rem]">
              Ibn Kathir frequently comments on several ayahs together. Where that happens the
              panel shows the full entry and labels the verse range it covers, rather than
              repeating the same commentary for each ayah. AI-generated notes are a study aid,
              not a source of religious rulings — check anything important against the tafsir
              itself and a qualified teacher.
            </p>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
