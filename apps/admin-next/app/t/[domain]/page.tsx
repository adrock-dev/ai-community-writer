import DomainClient from "@/components/DomainClient";

export default async function DomainPage({ params, searchParams }: { params: Promise<{ domain: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { domain } = await params;
  const { tab } = await searchParams;
  return <DomainClient domain={decodeURIComponent(domain)} initialTab={tab} />;
}
