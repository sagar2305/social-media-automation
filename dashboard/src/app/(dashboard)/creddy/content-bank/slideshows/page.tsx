import { CreddyContentBankPage } from "../content-bank-view";

export const dynamic = "force-dynamic";

export default async function CreddySlideshowsPage({ searchParams }: { searchParams: Promise<{ item?: string; updated?: string }> }) {
  const { item, updated } = await searchParams;
  return <CreddyContentBankPage mediaType="slideshow" selectedId={item} updated={updated} />;
}
