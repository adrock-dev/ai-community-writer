import DomainClient from "@/components/DomainClient";

export default async function DomainJobsPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  return <DomainClient domain={decodeURIComponent(domain)} view="jobs" />;
}
