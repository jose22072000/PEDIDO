import type { Producto } from "@/domain";

import React from "react";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Chip,
  useDisclosure,
  Spinner,
} from "@heroui/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// icons not needed in this page; keep page minimal
import { useProductoStore } from "@/stores/entityStores";
import { NavigationHeading } from "@/components/navigation-heading";

// Zod schema para validación de producto
const productoSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  sku: z.string().min(1, "El SKU es requerido"),
  descripcion: z.string().optional(),
  categoriaId: z.string().optional(),
  grupoId: z.string().optional(),
  proveedorId: z.string().optional(),
  sucursalId: z.string().optional(),
});

type ProductoFormData = z.infer<typeof productoSchema>;

export default function GestionProductosPage() {
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [editingProduct, setEditingProduct] = React.useState<Producto | null>(
    null,
  );
  const productoStore = useProductoStore();
  const [productos, setProductos] = React.useState<Producto[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProductoFormData>({
    resolver: zodResolver(productoSchema),
  });

  React.useEffect(() => {
    loadProductos();
  }, []);

  const loadProductos = async () => {
    setIsLoading(true);
    await productoStore.loadAll();
    setProductos(productoStore.items);
    setIsLoading(false);
  };

  const onSubmit = async (data: ProductoFormData) => {
    try {
      if (editingProduct) {
        // Actualizar producto existente
        await productoStore.update(editingProduct.id, {
          ...data,
        });
      } else {
        // Crear nuevo producto
        await productoStore.create({
          id: `prod_${Date.now()}`,
          ...data,
          activo: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as Producto);
      }
      setProductos(productoStore.items);
      handleClose();
      onOpenChange();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error al guardar producto:", error);
    }
  };

  const handleEdit = (producto: Producto) => {
    setEditingProduct(producto);
    reset({
      nombre: producto.nombre,
      sku: producto.sku,
      descripcion: producto.descripcion || "",
      categoriaId: producto.categoriaId || "",
      grupoId: producto.grupoId || "",
      proveedorId: producto.proveedorId || "",
      sucursalId: producto.sucursalId || "",
    });
    onOpen();
  };

  const handleDelete = async (id: string) => {
    if (confirm("¿Estás seguro de eliminar este producto?")) {
      await productoStore.remove(id);
      setProductos(productoStore.items);
    }
  };

  const handleClose = () => {
    setEditingProduct(null);
    reset({
      nombre: "",
      sku: "",
      descripcion: "",
      categoriaId: "",
      grupoId: "",
      proveedorId: "",
      sucursalId: "",
    });
  };

  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        paragraph="Visualiza todas las acciones a realizar en este panel"
        title="Catálogo y Gestión de Productos"
      />

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Spinner color="warning" size="lg" />
        </div>
      ) : productos.length === 0 ? (
        <Card className="p-10">
          <CardBody className="text-center">
            <p className="text-default-500">No hay productos registrados</p>
            <Button
              className="mt-4"
              color="warning"
              variant="flat"
              onPress={onOpen}
            >
              Crear primer producto
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {productos.map((producto) => (
            <Card key={producto.id} className="p-4">
              <CardHeader className="flex flex-col items-start gap-2">
                <div className="flex justify-between w-full items-start">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-xl font-bold">{producto.nombre}</h3>
                    <p className="text-sm text-default-500">
                      SKU: {producto.sku}
                    </p>
                  </div>
                  <Chip
                    color={producto.activo ? "success" : "danger"}
                    size="sm"
                    variant="flat"
                  >
                    {producto.activo ? "Activo" : "Inactivo"}
                  </Chip>
                </div>
              </CardHeader>
              <CardBody>
                {producto.descripcion && (
                  <p className="text-sm text-default-600 line-clamp-2">
                    {producto.descripcion}
                  </p>
                )}
              </CardBody>
              <CardFooter className="flex gap-2">
                <Button
                  className="flex-1"
                  color="primary"
                  size="sm"
                  variant="flat"
                  onPress={() => handleEdit(producto)}
                >
                  Editar
                </Button>
                <Button
                  className="flex-1"
                  color="danger"
                  size="sm"
                  variant="flat"
                  onPress={() => handleDelete(producto.id)}
                >
                  Eliminar
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Modal para crear/editar producto */}
      <Modal
        isOpen={isOpen}
        size="2xl"
        onClose={handleClose}
        onOpenChange={onOpenChange}
      >
        <ModalContent>
          {(onClose) => (
            <form onSubmit={handleSubmit(onSubmit)}>
              <ModalHeader className="flex flex-col gap-1">
                {editingProduct ? "Editar Producto" : "Nuevo Producto"}
              </ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  {...register("nombre")}
                  isRequired
                  errorMessage={errors.nombre?.message}
                  isInvalid={!!errors.nombre}
                  label="Nombre"
                  placeholder="Nombre del producto"
                  variant="bordered"
                />
                <Input
                  {...register("sku")}
                  isRequired
                  errorMessage={errors.sku?.message}
                  isInvalid={!!errors.sku}
                  label="SKU"
                  placeholder="Código único del producto"
                  variant="bordered"
                />
                <Input
                  {...register("descripcion")}
                  errorMessage={errors.descripcion?.message}
                  isInvalid={!!errors.descripcion}
                  label="Descripción"
                  placeholder="Descripción del producto"
                  variant="bordered"
                />
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    {...register("categoriaId")}
                    label="Categoría ID"
                    placeholder="ID de categoría"
                    variant="bordered"
                  />
                  <Input
                    {...register("grupoId")}
                    label="Grupo ID"
                    placeholder="ID de grupo"
                    variant="bordered"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    {...register("proveedorId")}
                    label="Proveedor ID"
                    placeholder="ID de proveedor"
                    variant="bordered"
                  />
                  <Input
                    {...register("sucursalId")}
                    label="Sucursal ID"
                    placeholder="ID de sucursal"
                    variant="bordered"
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="light" onPress={onClose}>
                  Cancelar
                </Button>
                <Button
                  color="warning"
                  isDisabled={isSubmitting}
                  isLoading={isSubmitting}
                  type="submit"
                >
                  {editingProduct ? "Actualizar" : "Crear"}
                </Button>
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      </Modal>
    </section>
  );
}
