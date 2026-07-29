import DraftsClient from "@/components/DraftsClient";

export default async function DraftsPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  return <DraftsClient domain={decodeURIComponent(domain)} />;
}
