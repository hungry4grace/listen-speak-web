// Wrapper so the react-quill-new library AND its stylesheet land in a lazy chunk
// (loaded only when the set editor opens), instead of the initial bundle.
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

export default ReactQuill;
