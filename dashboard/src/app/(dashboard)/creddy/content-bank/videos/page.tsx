import { CreddyContentBankPage } from "../content-bank-view";

export const dynamic = "force-dynamic";

export default async function CreddyVideosPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { item } = await searchParams;
  return <CreddyContentBankPage mediaType="video" selectedId={item} />;
}
