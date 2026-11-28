import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "alepha/react/router";

import { posts } from "../../config/blog.ts";
import BlogPostMeta from "../blog/BlogPostMeta.tsx";

import styles from "../blog/Blog.module.css";

/**
 * The three latest posts of the blog, on the front page. Absent while the
 * blog has none.
 */
const EcosystemPosts = () => {
  const latest = posts.slice(0, 3);
  if (latest.length === 0) {
    return null;
  }
  return (
    <section id="posts" className="home-block home-section home-section-alt">
      <div className="container-wide container">
        <div className="section-head">
          <h2 className="section-title">From the blog</h2>
          <p className="section-sub">
            The stories behind the changelog.{" "}
            <Link href="/blog" className="doc-link">
              Every post
              <IconArrowRight
                size={14}
                aria-hidden="true"
                style={{ verticalAlign: "middle", marginLeft: 4 }}
              />
            </Link>
          </p>
        </div>

        <ol className="eco-posts" aria-label="Latest posts">
          {latest.map((post) => (
            <li key={post.slug}>
              <Link href={`/blog/${post.slug}`} className={styles.card}>
                <BlogPostMeta date={post.date} product={post.product} />
                <h3 className={styles.cardTitle}>{post.title}</h3>
                <p className={styles.cardText}>{post.description}</p>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
};

export default EcosystemPosts;
