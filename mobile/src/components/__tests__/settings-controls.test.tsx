import { fireEvent, render } from '@testing-library/react-native';

import { ConfirmDeleteModal } from '../confirm-delete-modal';
import { EditableList } from '../editable-list';

jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

jest.mock('@/components/reorder-sheet', () => ({
  ReorderSheet: () => null,
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    text: '#142321',
    textSecondary: '#64726E',
    background: '#F5F7F6',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E7EFEC',
    border: '#DDE5E2',
    borderStrong: '#C7D3CF',
    accent: '#0F766E',
    accentMuted: '#DFF1ED',
    onAccent: '#FFFFFF',
    spend: '#D14D47',
    spendMuted: '#FBE9E7',
    income: '#247B58',
    incomeMuted: '#E4F3EB',
    review: '#B66A00',
    reviewMuted: '#FFF2D8',
    onReview: '#2C1B00',
    overlay: 'rgba(8, 18, 16, 0.48)',
    shadow: '#0B1714',
    skeleton: '#DCE6E2',
    focus: '#0F766E',
  }),
}));

describe('Settings safety and list controls', () => {
  it('requires typed DELETE and keeps backup-first available', async () => {
    const onBackupFirst = jest.fn();
    const onConfirm = jest.fn();
    const screen = await render(
      <ConfirmDeleteModal
        visible
        count={8}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
        onBackupFirst={onBackupFirst}
      />,
    );

    const deleteButton = screen.getByRole('button', { name: 'Delete all' });
    expect(deleteButton).toHaveProp('accessibilityState', { disabled: true, busy: false });

    await fireEvent.press(screen.getByRole('button', { name: 'Back up to Drive first' }));
    expect(onBackupFirst).toHaveBeenCalledTimes(1);

    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm deletion'), 'delete');
    const enabledDeleteButton = screen.getByRole('button', { name: 'Delete all' });
    expect(enabledDeleteButton).toHaveProp('accessibilityState', { disabled: false, busy: false });

    await fireEvent.press(enabledDeleteButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('preserves category open, rename, emoji, delete, and add actions', async () => {
    const onAdd = jest.fn();
    const onRename = jest.fn();
    const onDelete = jest.fn();
    const onOpen = jest.fn();
    const screen = await render(
      <EditableList
        items={[{ id: 1, name: 'Food', emoji: '🍲', hint: '2 subcategories' }]}
        withEmoji
        addLabel="New category"
        onAdd={onAdd}
        onRename={onRename}
        onDelete={onDelete}
        onReorder={jest.fn()}
        onOpen={onOpen}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Food, 2 subcategories' }));
    expect(onOpen).toHaveBeenCalledWith({
      id: 1,
      name: 'Food',
      emoji: '🍲',
      hint: '2 subcategories',
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Edit Food' }));
    await fireEvent.changeText(screen.getByLabelText('Category emoji'), '🍜');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Meals');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).toHaveBeenCalledWith(1, 'Meals', '🍜');

    await fireEvent.press(screen.getByRole('button', { name: 'Delete Food' }));
    expect(onDelete).toHaveBeenCalledWith({
      id: 1,
      name: 'Food',
      emoji: '🍲',
      hint: '2 subcategories',
    });

    await fireEvent.press(screen.getByRole('button', { name: 'New category' }));
    await fireEvent.changeText(screen.getByLabelText('Category emoji'), '🚕');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Travel');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith('Travel', '🚕');
  });
});
