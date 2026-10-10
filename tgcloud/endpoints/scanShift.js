import { EndpointError } from 'sdk';
// Legacy photo-less endpoint intentionally disabled: a QR alone must not create a shift.
export default async function(){throw new EndpointError('Сделайте селфи через камеру Mini App для отметки',{code:'PHOTO_REQUIRED'});}
