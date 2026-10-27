// Elements React renders fine but its types do not list yet.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      /** customizable select: mirrors the chosen option inside the select's own button */
      selectedcontent: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
