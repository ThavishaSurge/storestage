import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

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
        <h1 className={styles.heading}>StoreStage</h1>
        <p className={styles.text}>
          Stage changes on a copy of your store, then ship only what you approve — without overwriting
          your client&apos;s live edits.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Theme Compare</strong>. Merge a working copy with the live theme: client edits are kept,
            theme-editor JSON merges key by key, and real conflicts are yours to decide.
          </li>
          <li>
            <strong>Clone &amp; promote</strong>. Pair a staging store, clone live into it, and promote reviewed
            products, collections, pages, menus, metaobjects and more back to live.
          </li>
          <li>
            <strong>Safe by default</strong>. Three-way diffs, staleness checks, pre-push snapshots, an audit log and
            one-click rollback.
          </li>
        </ul>
      </div>
    </div>
  );
}
