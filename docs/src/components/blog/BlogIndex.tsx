import { IconRss } from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import { useState } from "react";

import { type BlogProduct, blogProducts, posts } from "../../config/blog.ts";
import StatusBar from "../layout/StatusBar.tsx";
import BlogPostMeta from "./BlogPostMeta.tsx";

import styles from "./Blog.module.css";

/**
 * `/blog`: every post, newest first, with a product filter. The filter is
 * state, never the URL: the page is prerendered once, so it opens on every
 * post, which is also what the HTML a crawler reads holds.
 */
const BlogIndex = () => {
  const [product, setProduct] = useState<BlogProduct | undefined>();
  const shown = product
    ? posts.filter((post) => post.product === product)
    : posts;
  const choices = [{ id: undefined, label: "All" }, ...blogProducts];

  return (
    <div className="terminal-page">
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Blog</h1>
          <p className={styles.lead}>
            The stories behind the changelog, one post per subject, for the
            framework, Lore and Bay.
          </p>
          <a className={styles.rss} href="/blog/rss.xml">
            <IconRss size={14} aria-hidden="true" />
            RSS
          </a>
          <div
            className={styles.filter}
            role="group"
            aria-label="Filter posts by product"
          >
            {choices.map((choice) => (
              <button
                key={choice.label}
                type="button"
                className={`${styles.filterButton} ${product === choice.id ? styles.filterButtonActive : ""}`}
                aria-pressed={product === choice.id}
                onClick={() => setProduct(choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </header>

        {shown.length > 0 ? (
          <ol className={styles.list} aria-label="Posts">
            {shown.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`} className={styles.card}>
                  <BlogPostMeta date={post.date} product={post.product} />
                  <h2 className={styles.cardTitle}>{post.title}</h2>
                  <p className={styles.cardText}>{post.description}</p>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>No post yet.</p>
        )}
      </div>

      <div
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100 }}
      >
        <StatusBar />
      </div>
    </div>
  );
};

export default BlogIndex;
