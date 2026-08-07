import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATABASE_NAME } from '../../storage/database';
import { ProfilePage } from './ProfilePage';

beforeEach(async () => {
  await deleteDB(DATABASE_NAME);
});

describe('情境 Profile', () => {
  it('三個情境分開切換，只有加碼顯示相對均價', async () => {
    render(<ProfilePage />);
    expect(await screen.findByRole('tab', { name: '建立部位' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('相對均價')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '加碼' }));

    expect(screen.getAllByText('相對均價').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: '加碼' })).toHaveAttribute('aria-selected', 'true');
  });
});
