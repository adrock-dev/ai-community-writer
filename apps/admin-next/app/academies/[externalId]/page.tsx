import AcademyDetailClient from "@/components/AcademyDetailClient";

export default async function AcademyDetailPage({ params }: { params: Promise<{ externalId: string }> }) {
  const { externalId } = await params;
  return <AcademyDetailClient externalId={decodeURIComponent(externalId)} />;
}
