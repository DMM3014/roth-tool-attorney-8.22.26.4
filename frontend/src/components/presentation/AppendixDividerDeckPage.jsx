import { Page } from "./printPrimitives";
import { AppendixDividerBody } from "@/components/shared/PrintBlocks";

/**
 * AppendixDividerDeckPage — separates the client conversation from the
 * methodology / disclosure reference pages at the back of the deck.
 */
export const AppendixDividerDeckPage = ({ items }) => (
  <Page testid="presentation-page-appendix-divider">
    <AppendixDividerBody items={items} testid="deck-appendix-divider-body" />
  </Page>
);

export default AppendixDividerDeckPage;
