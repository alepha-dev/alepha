import { IconArrowLeft } from "@tabler/icons-react";
import { Link } from "alepha/react/router";

import type { BlogProduct } from "../../config/blog.ts";
import HtmlContent from "../doc/HtmlContent.tsx";
import StatusBar from "../layout/StatusBar.tsx";
import BlogPostMeta from "./BlogPostMeta.tsx";

import styles from "./Blog.module.css";

/**
 * The post beside another, for the pager.
 */
export interface BlogPostLink {
  slug: string;
  title: string;
}

export interface BlogPostProps {
  title: string;
  date: string;
  product: BlogProduct;
  content: string;
  older?: BlogPostLink;
  newer?: BlogPostLink;
}

/**
 * `/blog/:slug`: one post, then links to the one before and the one after.
 */
const BlogPost = (props: BlogPostProps) => {
  return (
    <div className="terminal-page">
      <article className={styles.container}>
        <header className={styles.postHeader}>
          <Link href="/blog" className={styles.back}>
            <IconArrowLeft size={16} aria-hidden="true" />
            <span>Blog</span>
          </Link>
          <BlogPostMeta date={props.date} product={props.product} />
          <h1 className={styles.postTitle}>{props.title}</h1>
        </header>

        <HtmlContent html={props.content} />

        {props.older || props.newer ? (
          <nav className={styles.pager} aria-label="More posts">
            {props.older ? (
              <Link
                href={`/blog/${props.older.slug}`}
                className={styles.pagerLink}
                rel="prev"
              >
                <span className={styles.pagerLabel}>Older</span>
                {props.older.title}
              </Link>
            ) : null}
            {props.newer ? (
              <Link
                href={`/blog/${props.newer.slug}`}
                className={`${styles.pagerLink} ${styles.pagerNext}`}
                rel="next"
              >
                <span className={styles.pagerLabel}>Newer</span>
                {props.newer.title}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>

      <div
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100 }}
      >
        <StatusBar />
      </div>
    </div>
  );
};

export default BlogPost;
