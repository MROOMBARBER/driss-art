import { createRoot } from 'react-dom/client';
import App from './App';
import './portal.css';

const element = document.querySelector('#root');
if (!element) throw new Error('Missing application root');
createRoot(element).render(<App />);
