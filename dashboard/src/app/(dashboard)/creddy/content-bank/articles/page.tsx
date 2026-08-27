import { CreddyContentBankPage } from "../content-bank-view";

export default async function CreddyArticleReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; updated?: string }>;
}) {
  const params = await searchParams;
  return <CreddyContentBankPage mediaType="article" selectedId={params.item} updated={params.updated} />;
}
