/* eslint-disable no-param-reassign */
import type { API, FileInfo } from 'jscodeshift';
import { babelParse, babelParseExpression, parserOptions } from '@storybook/csf-tools';
import { remark } from 'remark';
import remarkMdx from 'remark-mdx';
import visit from 'unist-util-visit';
import { is } from 'unist-util-is';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { MdxjsEsm } from 'mdast-util-mdxjs-esm';
import * as t from '@babel/types';
import { BabelFile } from '@babel/core';
import * as babel from '@babel/core';
import * as recast from 'recast';
import * as path from 'node:path';
import { dedent } from 'ts-dedent';
import { capitalize } from 'lodash';
import { MdxJsxAttribute, MdxJsxExpressionAttribute } from 'mdast-util-mdx-jsx';
import { attribute } from 'unist-util-select/lib/attribute';
import * as parser from '@babel/parser';
import * as generate from '@babel/generator';
import prettier from 'prettier';

export default function (info: FileInfo, api: API, options: { parser?: string }) {
  const fileName = path.basename(info.path);
  const [root] = transform(info.source, fileName);

  return root;

  // TODO what do I need to with the title?
  // const fileNode = loadCsf(info.source, { makeTitle: (title) => title })._ast;
  // // @ts-expect-error File is not yet exposed, see https://github.com/babel/babel/issues/11350#issuecomment-644118606
  // const file: BabelFile = new babel.File(
  //   { filename: info.path },
  //   { code: info.source, ast: fileNode }
  // );

  // let output = recast.print(file.path.node).code;

  // try {
  //   const prettierConfig = prettier.resolveConfig.sync('.', { editorconfig: true }) || {
  //     printWidth: 100,
  //     tabWidth: 2,
  //     bracketSpacing: true,
  //     trailingComma: 'es5',
  //     singleQuote: true,
  //   };
  //
  //   output = prettier.format(output, { ...prettierConfig, filepath: info.path });
  // } catch (e) {
  //   console.log(`Failed applying prettier to ${info.path}.`);
  // }
  //
  // return output;
}

export function transform(
  source: string,
  filename: string
): [mdx: string, csf: string, newFileName: string] {
  const root = remark().use(remarkMdx).parse(source);

  // rewrite imports
  const esm: string[] = [];
  visit(root, ['mdxjsEsm'], (node: MdxjsEsm) => {
    node.value = node.value.replace('@storybook/addon-docs', '@storybook/blocks');

    esm.push(node.value);
  });
  const esmSource = `${esm.join('\n\n')}`;

  const ast: t.File = babelParse(esmSource);
  // @ts-expect-error File is not yet exposed, see https://github.com/babel/babel/issues/11350#issuecomment-644118606
  const file: BabelFile = new babel.File({ filename: 'info.path' }, { code: esmSource, ast });

  let meta: MdxJsxFlowElement | MdxJsxTextElement;
  const stories: (MdxJsxFlowElement | MdxJsxTextElement)[] = [];

  const baseName = filename
    .replace('.stories.mdx', '')
    .replace('story.mdx', '')
    .replace('.mdx', '');

  let found = false;

  visit(root, ['mdxjsEsm'], (node: MdxjsEsm) => {
    if (!found) {
      node.value += '\n';
      node.value += dedent`
        import * as ${baseName}Stories from './${baseName}.stories';
      `;
      found = true;
    }
  });

  const metaAttributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute> = [];

  const storiesMap = new Map<
    string,
    { attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>; children: unknown[] }
  >();

  visit(
    root,
    ['mdxJsxFlowElement', 'mdxJsxTextElement'],
    (node: MdxJsxFlowElement | MdxJsxTextElement, index, parent) => {
      if (is(node, { name: 'Meta' })) {
        metaAttributes.push(...node.attributes);
        node.attributes = [
          {
            type: 'mdxJsxAttribute',
            name: 'of',
            value: {
              type: 'mdxJsxAttributeValueExpression',
              value: `${baseName}Stories`,
            },
          },
        ];
        meta = node;
      }
      if (is(node, { name: 'Story' })) {
        const found = node.attributes.find((it) => {
          if (it.type === 'mdxJsxAttribute') {
            return it.name === 'name';
          }
        });

        if (typeof found?.value === 'string') {
          const name = capitalize(found.value);
          storiesMap.set(name, { attributes: node.attributes, children: node.children });
          node.attributes = [
            {
              type: 'mdxJsxAttribute',
              name: 'of',
              value: {
                type: 'mdxJsxAttributeValueExpression',
                value: `${baseName}Stories.${name}`,
              },
            },
          ];

          node.children = [];
        } else {
          parent.children.splice(index, 1);
          // FIXME: stop traversing
        }
        stories.push(node);
      }
    }
  );

  // rewrite exports to normal variables

  const metaProperties = metaAttributes.flatMap((attribute) => {
    if (attribute.type === 'mdxJsxAttribute') {
      if (typeof attribute.value === 'string') {
        return [t.objectProperty(t.identifier(attribute.name), t.stringLiteral(attribute.value))];
      }
      return [
        t.objectProperty(t.identifier(attribute.name), babelParseExpression(attribute.value.value)),
      ];
    }
    return [];
  });

  file.path.traverse({
    ExportNamedDeclaration(path) {
      path.replaceWith(path.node.declaration);
    },
  });

  // file.path.traverse({
  //   Statement(path) {
  //     path.insertAfter(t.exportDefaultDeclaration(t.objectExpression([])));
  //
  //     //
  //     // const last = path.get('body').pop();
  //     //
  //     // console.log(last);
  //     //
  //     // path.node.body.push();
  //
  //     // body.push();
  //     // path.get('body').push();
  //   },
  // });

  const body = file.path.get('body');
  const last = body[body.length - 1];

  const newStatements: t.Statement[] = [];

  newStatements.push(t.exportDefaultDeclaration(t.objectExpression(metaProperties)));

  const mapChildrenToRender = (children: unknown[]) => {
    const child = children[0];

    if (!child) return undefined;

    if (child.type === 'mdxFlowExpression') {
      const expression = babelParseExpression(child.value);
      const BIND_REGEX = /\.bind\(.*\)/;
      if (BIND_REGEX.test(child.value)) {
        return expression;
      }
      return t.arrowFunctionExpression([], expression);
    }
  };

  storiesMap.forEach((value, key) => {
    console.log(value.children);
    const renderProperty = mapChildrenToRender(value.children);
    newStatements.push(
      t.exportNamedDeclaration(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier(key),
            t.objectExpression([
              ...(renderProperty
                ? [t.objectProperty(t.identifier('render'), mapChildrenToRender(value.children))]
                : []),
              ...value.attributes.flatMap((attribute) => {
                if (attribute.type === 'mdxJsxAttribute') {
                  if (typeof attribute.value === 'string') {
                    return [
                      t.objectProperty(
                        t.identifier(attribute.name),
                        t.stringLiteral(attribute.value)
                      ),
                    ];
                  }
                  return [
                    t.objectProperty(
                      t.identifier(attribute.name),
                      babelParseExpression(attribute.value.value)
                    ),
                  ];
                }
                return [];
              }),
            ])
          ),
        ])
      )
    );
  });

  last.insertAfter(newStatements);
  // last.insertAfter(t.exportNamedDeclaration(t.objectExpression([])));

  const newMdx = remark().use(remarkMdx).stringify(root) as unknown as string;
  console.log(file.path.node);
  let output = recast.print(file.path.node).code;

  const prettierConfig = prettier.resolveConfig.sync('.', { editorconfig: true }) || {
    printWidth: 100,
    tabWidth: 2,
    bracketSpacing: true,
    trailingComma: 'es5',
    singleQuote: true,
  };

  const newFileName = `${baseName}.stories.tsx`;

  output = prettier.format(output, { ...prettierConfig, filepath: newFileName });
  return [newMdx, output, newFileName];
}

// const x = {
//   render: (...a) => {
//     const received = ();
//     return typeof received === 'function' ? received(...a) : received;
//   }
// }

export const b = {
  //asdf
};
