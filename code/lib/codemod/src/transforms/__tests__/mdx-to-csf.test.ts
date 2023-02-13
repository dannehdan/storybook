import { describe, expect, it } from '@jest/globals';
import type { API } from 'jscodeshift';
import dedent from 'ts-dedent';
import _transform, { transform } from '../mdx-to-csf';

expect.addSnapshotSerializer({
  print: (val: any) => val,
  test: () => true,
});

const tsTransform = (source: string) =>
  _transform({ source, path: 'components/Foobar/Foobar.stories.mdx' }, {} as API, {
    parser: 'tsx',
  }).trim();

describe('mdx-to-csf', () => {
  it('rewrite import', () => {
    const input = dedent`
      import { Meta, Story } from '@storybook/addon-docs';

      <Meta title="Foobar" />
    `;

    expect(tsTransform(input)).toMatchInlineSnapshot(`
      import { Meta, Story } from '@storybook/blocks';
      import * as FoobarStories from './Foobar.stories';

      <Meta of={FoobarStories} />
    `);
  });

  it('drop invalid story nodes', () => {
    const input = dedent`
      import { Meta, Story } from '@storybook/addon-docs';

      <Meta title="Foobar" />
      
      <Story>No name!</Story>
      
    `;

    expect(tsTransform(input)).toMatchInlineSnapshot(`
      import { Meta, Story } from '@storybook/blocks';
      import * as FoobarStories from './Foobar.stories';

      <Meta of={FoobarStories} />
    `);
  });

  it('drop invalid story nodes', () => {
    const input = dedent`
      import { Meta, Story } from '@storybook/addon-docs';

      <Meta title="Foobar" />
      
      <Story name="Primary">No name!</Story>
      
    `;

    expect(tsTransform(input)).toMatchInlineSnapshot(`
      import { Meta, Story } from '@storybook/blocks';
      import * as FoobarStories from './Foobar.stories';

      <Meta of={FoobarStories} />

      <Story of={FoobarStories.Primary} />
    `);
  });

  it('extract esm into csf head code', () => {
    const input = dedent`
      import { Canvas, Meta, Story } from '@storybook/addon-docs';

      # hello

      export const args = { bla: 1 };
      
      <Meta title="foobar" />

      world {2 + 1}

      <Story name="foo">bar</Story>
      
      <Story 
        name="Unchecked"
        args={{
          ...args,
          label: 'Unchecked',
        }}>
        {Template.bind({})}
      </Story>
    `;

    const [mdx, csf, newFileName] = transform(input, 'Foobar.stories.mdx');
    expect(mdx).toMatchInlineSnapshot(`
      import { Canvas, Meta, Story } from '@storybook/blocks';
      import * as FoobarStories from './Foobar.stories';

      # hello

      export const args = { bla: 1 };

      <Meta of={FoobarStories} />

      world {2 + 1}

      <Story of={FoobarStories.Foo} />

      <Story of={FoobarStories.Unchecked} />

    `);
    expect(csf).toMatchInlineSnapshot(`
      import { Canvas, Meta, Story } from '@storybook/blocks';

      const args = { bla: 1 };

      export default {
        title: 'foobar',
      };

      export const Foo = {
        name: 'foo',
      };

      export const Unchecked = {
        render: Template.bind({}),
        name: 'Unchecked',

        args: {
          ...args,
          label: 'Unchecked',
        },
      };

    `);

    expect(newFileName).toMatchInlineSnapshot(`Foobar.stories.tsx`);
  });

  it('extract all meta parameters', () => {
    const input = dedent`
      import { Meta } from '@storybook/addon-docs';

      export const args = { bla: 1 };
      
      <Meta title="foobar" args={{...args}} parameters={{a: '1'}} />
    `;

    const [, csf] = transform(input, 'Foobar.stories.mdx');

    expect(csf).toMatchInlineSnapshot(`
      import { Meta } from '@storybook/blocks';

      const args = { bla: 1 };

      export default {
        title: 'foobar',

        args: {
          ...args,
        },

        parameters: {
          a: '1',
        },
      };

    `);
  });

  it('extract all story attributes', () => {
    const input = dedent`
      import { Meta, Story } from '@storybook/addon-docs';

      export const args = { bla: 1 };
      
      <Meta title="foobar" />

      <Story name="foo">bar</Story>
      
      <Story 
        name="Unchecked"
        args={{
          ...args,
          label: 'Unchecked',
        }}>    
        {Template.bind({})}
      </Story>
    `;

    const [, csf] = transform(input, 'Foobar.stories.mdx');

    expect(csf).toMatchInlineSnapshot(`
      import { Meta, Story } from '@storybook/blocks';

      const args = { bla: 1 };

      export default {
        title: 'foobar',
      };

      export const Foo = {
        name: 'foo',
      };

      export const Unchecked = {
        render: Template.bind({}),
        name: 'Unchecked',

        args: {
          ...args,
          label: 'Unchecked',
        },
      };

    `);
  });
});
