import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { BrandMark } from "../../components/ui";

import styles from "./styles.module.css";

export const meta: MetaFunction = () => [
  { title: "ThemeMerge — publish your theme without losing the client's edits" },
  {
    name: "description",
    content:
      "Merge a theme working copy with the live theme a client kept editing. Theme-editor JSON merges key by key, Liquid line by line, and only the real conflicts are yours to decide.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <div className={styles.brand}>
          <BrandMark size={56} />
          <h1 className={styles.heading}>ThemeMerge</h1>
        </div>
        <p className={styles.text}>
          Publish your theme without losing the client&apos;s edits.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" placeholder="my-shop-domain.myshopify.com" />
            </label>
            <button className={styles.button} type="submit">
              Install
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Three-way merge</strong>. Record the fork point when the copy is made, and ThemeMerge knows
            exactly what each side changed — no guessing from timestamps.
          </li>
          <li>
            <strong>Structural, not textual</strong>. Theme-editor JSON merges key by key, section order merges as an
            ordered set, Liquid and CSS merge line by line.
          </li>
          <li>
            <strong>Nothing is overwritten</strong>. The live theme is never written. Take the merged result as a new
            theme, a zip, or straight into your working copy — snapshotted first.
          </li>
        </ul>
      </div>
    </div>
  );
}
