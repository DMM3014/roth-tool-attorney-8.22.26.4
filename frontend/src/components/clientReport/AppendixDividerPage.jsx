import { Page } from "./helpers";
import { AppendixDividerBody } from "@/components/shared/PrintBlocks";

/**
 * AppendixDividerPage — separates the client conversation from the advisor /
 * technical reference material at the back of the Client Report.
 */
export const AppendixDividerPage = ({ items, ...footProps }) => (
  <Page testid="cr-page-appendix-divider" {...footProps}>
    <AppendixDividerBody items={items} testid="cr-appendix-divider-body" />
  </Page>
);

export default AppendixDividerPage;
