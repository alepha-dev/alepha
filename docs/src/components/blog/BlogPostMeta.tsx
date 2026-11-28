import {
  type BlogProduct,
  blogDate,
  blogProductLabel,
} from "../../config/blog.ts";

import styles from "./Blog.module.css";

export interface BlogPostMetaProps {
  date: string;
  product: BlogProduct;
}

/**
 * A post's date and product, above its title in a card and on its page.
 */
const BlogPostMeta = (props: BlogPostMetaProps) => {
  return (
    <div className={styles.meta}>
      <time dateTime={props.date}>{blogDate(props.date)}</time>
      <span className={styles.tag}>{blogProductLabel(props.product)}</span>
    </div>
  );
};

export default BlogPostMeta;
