-- Arreglo de datos de vendedores — 03/08/2026
--
-- Correr con:
--   ssh root@179.198.107.1
--   C=$(docker ps -qf name=procovar-postgres-nlfols | head -1)
--   docker cp arreglo-vendedores-2026-08-03.sql $C:/tmp/
--   docker exec $C psql -U procovar -d procovar_pedidos -v ON_ERROR_STOP=1 -f /tmp/arreglo-vendedores-2026-08-03.sql
--
-- Backup previo: /var/backups/procovar/ (procovar_pedidos, 5.2M, 03/08 15:54).
-- Todo va en UNA transacción: o entra entero o no entra nada.
--
-- Qué arregla y por qué:
--
-- 1) LAS DOS GLENDA. Misma persona con dos fichas de vendedor:
--      glenda.melisa  GTO  1447 pedidos (todos en STG)  sin gestor
--      glenda.blanco  STG    28 pedidos (dup. de 28 de melisa)  con gestor
--    Evidencia de que los 28 son el MISMO pedido importado dos veces: mismo
--    cliente, mismo estado, mismos items, misma fecha; solo cambia la hora,
--    12:00 vs 16:00 = 4h justas = zona horaria de Cuba. La convención de la
--    base es 16:00 (31.697 pedidos frente a 1.233 a las 12:00), o sea que los
--    de melisa son los buenos y los 28 de blanco son la copia mal importada.
--    Además melisa es el ÚNICO vendedor de toda la base cuya sucursal de ficha
--    no coincide con la de sus pedidos.
--    => se conserva melisa (el histórico completo) y se borra blanco.
--    Nota: no se puede pasar melisa a STG sin borrar antes a blanco, porque
--    Vendedor tiene @@unique([sucursalId, nombre]) y chocarían.
--
-- 2) EL VENDEDOR FANTASMA: sin nombre, sin código y sin un solo pedido.
--
-- 3) SIN ASIGNAR NO LLEVA SUCURSAL. Un vendedor sin gestor no pertenece a
--    ninguna sucursal. Se la ponía el que subía el CSV, y así es como melisa
--    acabó fichada en GTO. El código ya está arreglado (orders.ts,
--    mantenimiento.ts, vendedores.ts); esto limpia lo que ya quedó torcido.

begin;

\echo '--- ANTES ---'
select s.code, su.codigo as sucursal, u.username as gestor,
       (select count(*) from "Order" o where o."sellerId" = s.id) as pedidos
  from "Seller" s
  left join "Sucursal" su on su.id = s."sucursalId"
  left join "User" u on u.id = s."gestorId"
 where upper(trim(s.name)) = 'GLENDA MELISA BLANCO ÁLVAREZ'
 order by 4 desc;

select count(*) filter (where "gestorId" is null and "sucursalId" is not null)
         as sin_gestor_pero_con_sucursal,
       count(*) filter (where name is null or trim(name) = '') as fantasmas
  from "Seller";

-- 1a) Fuera los 28 pedidos duplicados de glenda.blanco (items primero, por la FK).
delete from "OrderItem"
 where "orderId" in (select id from "Order" where "sellerId" = 'cmponz18j004201n4buepfbzu');

delete from "Order" where "sellerId" = 'cmponz18j004201n4buepfbzu';

-- 1b) Fuera la ficha duplicada. El USUARIO glenda.blanco NO se toca: es su login
--     y pasa a ser el gestor de la ficha buena.
delete from "Seller" where id = 'cmponz18j004201n4buepfbzu';

-- 1c) Ya sin choque de unicidad: melisa a su sucursal real (STG) y con su gestor.
update "Seller"
   set "sucursalId" = (select id from "Sucursal" where codigo = 'STG'),
       "gestorId"   = 'cad2b58adc028fb0f9447a938'
 where id = 'cms6k6mlf001901mvwb60qu0a';

-- 2) El fantasma. Con guardas: solo si de verdad está vacío y sin pedidos.
delete from "Seller" s
 where s.id = 'cmsdcv2iy00pk01lhibzdivaj'
   and (s.name is null or trim(s.name) = '')
   and not exists (select 1 from "Order" o where o."sellerId" = s.id);

-- 3) Sin gestor => sin sucursal. Sus pedidos históricos NO se tocan: al enlazarle
--    un gestor, el backend los recoloca solo (vendedores.ts, PATCH /:id/gestor).
update "Seller" set "sucursalId" = null
 where "gestorId" is null and "sucursalId" is not null;

\echo '--- DESPUES ---'
select s.code, su.codigo as sucursal, u.username as gestor,
       (select count(*) from "Order" o where o."sellerId" = s.id) as pedidos
  from "Seller" s
  left join "Sucursal" su on su.id = s."sucursalId"
  left join "User" u on u.id = s."gestorId"
 where upper(trim(s.name)) = 'GLENDA MELISA BLANCO ÁLVAREZ';

select count(*) as vendedores,
       count(*) filter (where "gestorId" is null) as sin_gestor,
       count(*) filter (where "gestorId" is null and "sucursalId" is not null)
         as sin_gestor_pero_con_sucursal,
       count(*) filter (where name is null or trim(name) = '') as fantasmas
  from "Seller";

commit;
