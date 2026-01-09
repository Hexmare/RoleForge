declare module 'react-markdown' {
  import { ComponentType, ReactElement } from 'react';
  import { PluggableList } from 'unified';

  interface ReactMarkdownProps {
    children?: string;
    className?: string;
    remarkPlugins?: PluggableList;
    rehypePlugins?: PluggableList;
    components?: Record<string, ComponentType<any>>;
    [key: string]: any;
  }

  const ReactMarkdown: ComponentType<ReactMarkdownProps>;
  export default ReactMarkdown;
}