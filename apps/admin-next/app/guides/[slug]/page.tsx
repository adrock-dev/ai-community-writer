import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDES, findGuide, readGuide } from "@/lib/guides";
import { renderDocMarkdown } from "@/lib/doc-markdown";

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = findGuide(slug);
  if (!meta) notFound();

  const markdown = readGuide(meta);
  return (
    <div className="grid">
      <div>
        <Link className="eyebrow" href="/guides">← 관리자 가이드</Link>
        <h1>{meta.title}</h1>
        <p className="muted small">
          <span className="badge">{meta.audience}</span> <code className="mono">{meta.file}</code>
        </p>
      </div>
      <div className="card card-pad doc-body">
        {markdown === null
          ? <p className="toast-warn">문서 파일을 찾지 못했습니다. 배포에 <code>docs/</code>가 포함됐는지 확인하세요.</p>
          : renderDocMarkdown(markdown)}
      </div>
    </div>
  );
}
