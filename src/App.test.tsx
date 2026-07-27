import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('顯示應用程式名稱作為主標題', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'DSS V2' })).toBeInTheDocument();
  });
});
