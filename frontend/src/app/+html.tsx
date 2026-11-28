import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function WebDocument({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } = useServerDocumentContext();

  return <html lang="en" {...htmlAttributes}>
    <head>
      <meta charSet="utf-8" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
      <ScrollViewStyleReset />
      {headNodes}
      <link rel="stylesheet" href="/styles/charging.css" />
      <link rel="stylesheet" href="/styles/contact.css" />
      <link rel="stylesheet" href="/styles/proposals.css" />
    </head>
    <body {...bodyAttributes}>
      {children}
      {bodyNodes}
    </body>
  </html>;
}
