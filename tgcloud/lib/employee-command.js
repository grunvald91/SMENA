import {DomainError} from './errors.js';

export const EMPLOYEE_EXAMPLE='/employee 123456789 350 Александр Петров';
export const EMPLOYEE_HELP=`Добавить сотрудника: ID → ставка за час → имя.\nПример: ${EMPLOYEE_EXAMPLE}\n123456789 замените на Telegram ID сотрудника (команда /id), 350 — на ставку в рублях, Александр Петров — на имя.\nТакже принимается: /employee 123456789 Александр Петров 350.`;

export function parseEmployeeCommand(args){
 const value=typeof args==='string'?args.trim().replace(/\s+/gu,' '):'';
 const first=/^(\d+) (\d{1,7}(?:[.,]\d{1,2})?) (.+)$/u.exec(value);
 const last=first?null:/^(\d+) (.+) (\d{1,7}(?:[.,]\d{1,2})?)$/u.exec(value);
 const match=first||last;
 if(!match)throw new DomainError('BAD_COMMAND',EMPLOYEE_HELP);
 const tgId=Number(match[1]),name=first?match[3]:match[2],rate=first?match[2]:match[3];
 if(!Number.isSafeInteger(tgId)||tgId<=0||!name.trim()||/^\d+(?:[.,]\d+)?$/u.test(name))throw new DomainError('BAD_COMMAND',EMPLOYEE_HELP);
 const [rubles,cents='']=rate.replace(',','.').split('.');
 return {tgId,name:name.trim(),hourlyKopeks:Number(rubles)*100+Number(cents.padEnd(2,'0'))};
}
