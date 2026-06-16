import DomainClient from "@/components/DomainClient";

export default async function DomainPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  return <DomainClient domain={decodeURIComponent(domain)} />;
}
